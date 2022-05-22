const core = require('@actions/core');
const exec = require('@actions/exec');
const fs = require('fs');
const jq = require('node-jq');

var IS_CARGO_WORKSPACE = false;
var CRATES = [];
var COMPANY_NAME = '';

async function runLicensee() {
  let output = '';
  const options = {};
  options.listeners = {
    stdout: (data) => {
      output += data.toString();
    }
  };
  const cwd = process.cwd();
  await exec.exec(
    'docker',
    [
      'run', '--rm', '--volume',
      `${cwd}:/usr/src/target`, 'licensee', 'detect',
      '/usr/src/target', '--json'
    ],
    options);
  return output;
}

async function parseInputs() {
  IS_CARGO_WORKSPACE = core.getBooleanInput('cargo-workspace', { required: false });
  if (IS_CARGO_WORKSPACE) {
    CRATES = core.getInput('crates', { required: false }).split(' ');
    if (CRATES.length == 0) {
      core.setFailed('If this repository is a workspace, the crates input must be\
        set to a space delimited set of crates.');
      return;
    }
  }
  COMPANY_NAME = core.getInput('company-name', { required: true });
  core.debug(`cargo-workspace input: ${IS_CARGO_WORKSPACE}`);
  core.debug(`crates input: ${CRATES}`);
  core.debug(`company-name input: ${COMPANY_NAME}`);
}

async function buildLicensee() {
  await exec.exec('git clone https://github.com/jacderida/licensee');
  const options = {};
  options.cwd = 'licensee'
  await exec.exec('git', ['checkout', 'add-user-to-docker'], options);
  await exec.exec('docker', ['build', '.', '--tag', 'licensee'], options);
}

async function verifyLicenseFiles() {
  let licenseeOutput;
  let jqOutput;
  try {
    licenseeOutput = await runLicensee();
    jqOutput = await jq.run(
      '.matched_files[].filename', licenseeOutput, { input: 'string', output: 'json' });
  } catch (err) {
    core.setFailed(`Action failed: ${err}`);
    return;
  }
  const matchedFiles = jqOutput.split('\n').map(filename => filename.replace(/\"/g, ''));
  core.info(`Licensee detected ${matchedFiles.length} files with license references:`);
  core.info(matchedFiles)
  if (matchedFiles.length < 2) {
    core.info('This repository is either missing a LICENSE file or no license is declared in the README.');
    core.info('Or both.');
    core.info('Please include a LICENSE file and a reference to it in the README.');
    core.setFailed('Verification failed. See above.');
    return;
  } else if (matchedFiles.length > 3) {
    if (!IS_CARGO_WORKSPACE) {
      core.info('Licensee detected more than three license references.');
      core.info('To keep things clean, please modify the repository to:');
      core.info('* Use one license in a LICENSE file at the root.');
      core.info('* Make a reference to the license in the README.');
      core.info('* If this is a Cargo repository, add a license to the Cargo manifest.');
      core.setFailed('Verification failed. See above.');
      return;
    }
  }
  if (!matchedFiles.includes('LICENSE')) {
    core.setFailed('Licensee did not detect a valid license in the LICENSE file.');
    return;
  }
  if (!matchedFiles.includes('README.md')) {
    core.setFailed('Licensee did not detect a valid license in the README file.');
    return;
  }

  core.info('License file verification passed.')
}

async function run() {
  await parseInputs();
  await buildLicensee();
  await verifyLicenseFiles();
}

run();
