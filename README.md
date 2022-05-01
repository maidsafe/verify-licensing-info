# Verify Licensing Info

A little custom action for verifying licensing information in a repository, particularly a Rust
repository.

So far, it verifies:

* The repo contains a LICENSE file.
* The README has a reference to a license.
* The README and LICENSE files use the same license.
* All Rust source files contain a copyright notice.
* All Rust source files contain a reference to the license reported by the API.
* The Cargo manifest contains a license and it matches the license from the LICENSE file.

Initially there was also an idea to check that all these license references were the same as what
was reported by the Github API, but unfortunately the Github API always detects what's on the main
branch, so you can't use this as a CI check; if you change your license, it will fail.

Right now, it only works with a repository that's a single crate. It'll need to be modified to use a
workspace, which will come soon.
