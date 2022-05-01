# Verify Licensing Info

A little custom action for verifying licensing information in a repository, particularly a Rust
repository.

So far, it verifies:

* A license is being picked up by the Github API.
* The repo contains a LICENSE file.
* The README has a reference to a license.
* The README and LICENSE files use the same license as reported by the API.
* All Rust source files contain a copyright notice.
* All Rust source files contain a reference to the license reported by the API.
* The Cargo manifest contains a license and it matches the license picked up by the Github API.

Right now, it only works with a repository that's a single crate. It'll need to be modified to use a
workspace, which will come soon.
