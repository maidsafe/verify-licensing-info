#!/usr/bin/env python

import argparse
import sys
import toml

def get_args():
    parser = argparse.ArgumentParser(
        prog="check-cargo-manifest",
        description="Checks a Cargo manifest for the presence of a license.",
    )
    parser.add_argument(
        "license",
        help="The name of the license to be present.",
    )
    parser.add_argument(
        "manifest_path",
        help="The path of the manifest to check.",
    )
    args = parser.parse_args()
    return (args.license, args.manifest_path)

def main():
    license, manifest_path = get_args()
    manifest = toml.load(manifest_path)
    if "license" not in manifest["package"]:
        print("The Cargo manifest does not contain a license for the package.")
        return 1
    manifest_license = manifest["package"]["license"]
    if license != manifest_license:
        print(f"The license in the manifest was expected to be '{license}'.")
        print(f"The actual value is '{manifest_license}'.")
        print(f"Update the manifest to use '{license}' for the license.")
        return 1
    return 0

if __name__ == "__main__":
    sys.exit(main())
