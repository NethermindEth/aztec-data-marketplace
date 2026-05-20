#!/usr/bin/env python3
"""
Drive the offchain circuit through several input sizes and capture
proving-time numbers.

What it does for each N in the list:
  1. Rewrites src/main.nr with the new global N.
  2. Generates a Prover.toml with N readings (all equal to BASE_READING) and
     placeholder h_d / params_hash.
  3. Runs `nargo compile`.
  4. Runs `nargo execute` (this fails the asserts but prints the real h_d and
     params_hash through the debug prints in main.nr).
  5. Parses the printed hashes, rewrites Prover.toml with the correct values.
  6. Runs `nargo execute` again (now passes, writes witness).
  7. Times `bb prove` and parses bb's own VK / prove timing from its log.
  8. Times `bb verify`.

Outputs a summary table at the end.

Usage:
  cd ~/data-marketplace/c2d/offchain-circuit
  python3 scale.py
"""

import re
import subprocess
import time
from pathlib import Path

# Adjust this list as we learn what's feasible. Start conservative.
SIZES = [50000]

# Constant reading value used for every entry. Keeps the generator trivial.
# Average will be exactly this value at every size, which makes the test
# vector boring but the cost numbers are unaffected.
BASE_READING = 67

CIRCUIT_DIR = Path(__file__).parent
SRC_FILE = CIRCUIT_DIR / "src" / "main.nr"
PROVER_FILE = CIRCUIT_DIR / "Prover.toml"
TARGET_DIR = CIRCUIT_DIR / "target"

# Read and cache the original main.nr so we can put it back at the end.
ORIGINAL_MAIN = SRC_FILE.read_text()


def rewrite_main_nr(n):
    """Update the global N and ensure debug prints are present. Also strips
    the #[test] block, whose array literal is hardcoded to N=30 and would
    fail to compile at other sizes."""
    text = ORIGINAL_MAIN

    # Strip everything from the test attribute to end-of-file. The test
    # function is the last item in main.nr.
    text = re.sub(
        r"\n// Local test:.*\Z",
        "\n",
        text,
        flags=re.DOTALL,
    )

    # Set N.
    text = re.sub(
        r"global N: u32 = \d+;",
        f"global N: u32 = {n};",
        text,
    )

    # Insert debug prints after each Poseidon2 computation if not already there.
    # We rewrite from a clean source each time so prints aren't compounded.
    text = text.replace(
        "let computed_h_d = Poseidon2::hash(commitment_input, N);\n    assert(computed_h_d == h_d);",
        "let computed_h_d = Poseidon2::hash(commitment_input, N);\n    println(f\"DEBUG h_d={computed_h_d}\");\n    assert(computed_h_d == h_d);",
    )
    text = text.replace(
        "    );\n    assert(computed_params_hash == params_hash);",
        "    );\n    println(f\"DEBUG params_hash={computed_params_hash}\");\n    assert(computed_params_hash == params_hash);",
    )

    SRC_FILE.write_text(text)


def write_prover_toml(n, h_d, params_hash, average_value, window_days):
    """Generate a Prover.toml with N readings and the given public inputs."""
    readings_lines = ",\n  ".join([f'"{BASE_READING}"' for _ in range(n)])
    contents = f"""readings = [
  {readings_lines}
]
h_d = "{h_d}"
params_hash = "{params_hash}"
average_value = "{average_value}"
window_days = "{window_days}"
"""
    PROVER_FILE.write_text(contents)


def run(cmd, capture=True):
    """Run a shell command, return (returncode, stdout, stderr, elapsed_s)."""
    start = time.time()
    result = subprocess.run(
        cmd,
        shell=True,
        cwd=CIRCUIT_DIR,
        capture_output=capture,
        text=True,
    )
    elapsed = time.time() - start
    return result.returncode, result.stdout or "", result.stderr or "", elapsed


def measure_one(n):
    """Run the full pipeline at size n and return timing dict."""
    print(f"\n{'=' * 60}")
    print(f"N = {n}")
    print(f"{'=' * 60}")

    # 1. Rewrite circuit and Prover.toml with placeholder hashes.
    rewrite_main_nr(n)
    write_prover_toml(n, h_d="0", params_hash="0", average_value=BASE_READING, window_days=n)

    # 2. Compile.
    print("Compiling...")
    rc, out, err, t_compile = run("nargo compile")
    if rc != 0:
        print(f"COMPILE FAILED:\n{err}")
        return None
    print(f"  compile time: {t_compile:.2f}s")

    # 3. First execute - panics at h_d assert, prints h_d only.
    print("First execute (extracting h_d)...")
    rc, out, err, _ = run("nargo execute")
    combined = out + err
    h_d_match = re.search(r"DEBUG h_d=(\S+)", combined)
    if not h_d_match:
        print(f"FAILED to extract h_d. Output was:\n{combined}")
        return None
    h_d = h_d_match.group(1)
    print(f"  h_d = {h_d[:18]}...")

    # 4. Rewrite with correct h_d, placeholder params_hash. Now execute panics
    # at params_hash assert, printing params_hash.
    write_prover_toml(n, h_d=h_d, params_hash="0",
                      average_value=BASE_READING, window_days=n)
    print("Second execute (extracting params_hash)...")
    rc, out, err, _ = run("nargo execute")
    combined = out + err
    params_hash_match = re.search(r"DEBUG params_hash=(\S+)", combined)
    if not params_hash_match:
        print(f"FAILED to extract params_hash. Output was:\n{combined}")
        return None
    params_hash = params_hash_match.group(1)
    print(f"  params_hash = {params_hash[:18]}...")

    # 5. Rewrite with both correct, third execute should fully pass.
    write_prover_toml(n, h_d=h_d, params_hash=params_hash,
                      average_value=BASE_READING, window_days=n)
    print("Third execute (with both correct)...")
    rc, out, err, t_execute = run("nargo execute")
    if rc != 0:
        print(f"EXECUTE FAILED:\n{err}")
        return None
    print(f"  execute time: {t_execute:.2f}s")

    # 6. Prove.
    print("Proving...")
    prove_cmd = (
        "bb prove "
        "-b target/average_over_window.json "
        "-w target/average_over_window.gz "
        "-o target/proof "
        "-t noir-recursive "
        "--write_vk "
        "--output_format json"
    )
    rc, out, err, t_prove_wall = run(prove_cmd)
    if rc != 0:
        print(f"PROVE FAILED:\n{err}\n{out}")
        return None

    bb_output = out + err
    vk_time = parse_ms(bb_output, r"Proving key computed in (\d+) ms")

    print(f"  prove wall time: {t_prove_wall:.2f}s")
    print(f"  VK precompute (per bb): {vk_time}ms" if vk_time else "  VK time not reported")

    # 7. Verify.
    print("Verifying...")
    verify_cmd = (
        "bb verify "
        "-k target/proof/vk.json "
        "-p target/proof/proof.json "
        "-i target/proof/public_inputs.json"
    )
    rc, out, err, t_verify_wall = run(verify_cmd)
    if rc != 0:
        print(f"VERIFY FAILED:\n{err}\n{out}")
        return None
    print(f"  verify wall time: {t_verify_wall:.2f}s")

    # 8. Artifact size as a rough circuit-size proxy.
    json_path = TARGET_DIR / "average_over_window.json"
    artifact_size = json_path.stat().st_size if json_path.exists() else 0

    return {
        "n": n,
        "compile_s": t_compile,
        "execute_s": t_execute,
        "prove_wall_s": t_prove_wall,
        "vk_precompute_ms": vk_time,
        "verify_wall_s": t_verify_wall,
        "artifact_bytes": artifact_size,
    }


def parse_ms(text, pattern):
    m = re.search(pattern, text)
    return int(m.group(1)) if m else None


def main():
    results = []
    try:
        for n in SIZES:
            r = measure_one(n)
            if r is not None:
                results.append(r)
            else:
                print(f"Stopping at N={n} due to failure.")
                break
    finally:
        # Always restore original main.nr.
        SRC_FILE.write_text(ORIGINAL_MAIN)
        # Restore a small Prover.toml so the repo state is sane.
        write_prover_toml(
            30,
            h_d="0x047b693a11e9b6dc87259eaf9fabe8062d5761881c8a2ad0b99b8d4f32cca8aa",
            params_hash="0x27f7a594a960aa9fb613f72113e0a07ae47ce65b8a09758b88f37fa919948e4b",
            average_value=67,
            window_days=30,
        )

    print(f"\n{'=' * 60}")
    print("SUMMARY")
    print(f"{'=' * 60}")
    print(f"{'N':>8} | {'compile':>9} | {'execute':>9} | {'prove(s)':>9} | {'VK(ms)':>9} | {'verify':>9} | {'artifact':>10}")
    print("-" * 80)
    for r in results:
        vk = f"{r['vk_precompute_ms']}" if r['vk_precompute_ms'] is not None else "-"
        print(f"{r['n']:>8} | {r['compile_s']:>8.2f}s | {r['execute_s']:>8.2f}s | {r['prove_wall_s']:>8.2f}s | {vk:>9} | {r['verify_wall_s']:>8.2f}s | {r['artifact_bytes']:>9}B")


if __name__ == "__main__":
    main()