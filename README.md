# Verify Licensing Info

A custom action for verifying licensing information in a repository, particularly a Rust repository.

Example usage for a single-crate repository:
```
- name: install rust
  id: toolchain
  uses: actions-rs/toolchain@v1
  with:
    profile: minimal
    toolchain: stable
    override: true
- name: install ripgrep
  run: cargo install ripgrep
- uses: maidsafe/verify-licensing-info@main
  name: verify licensing
  with:
    company-name: MaidSafe
```

Example usage for a workspace repository:
```
- name: install rust
  id: toolchain
  uses: actions-rs/toolchain@v1
  with:
    profile: minimal
    toolchain: stable
    override: true
- name: install ripgrep
  run: cargo install ripgrep
- uses: maidsafe/verify-licensing-info@main
  name: verify licensing
  with:
    company-name: MaidSafe
    cargo-workspace: true
    crates: "sn_interface sn_dysfunction sn_node sn_client sn_api sn_cli"
```

For verifying source files, the action relies on an installation of [ripgrep](https://crates.io/crates/ripgrep), hence the installation of the Rust toolchain to run the `cargo install`.

It verifies:

* The repository contains a LICENSE file.
* The README has a reference to a license and it matches the license from the LICENSE file.
* The Cargo manifest contains a license and it matches the license from the LICENSE file.
* All Rust source files contain a copyright notice with a license attribution.

If the repository is a Cargo workspace, all specified crates will be checked to make sure their
README and Cargo manifest matches the license in the LICENSE file at the root of the repository.
This means we wouldn't allow for crates in the same workspace to use different licenses.
