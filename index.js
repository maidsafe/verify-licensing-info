const core = require('@actions/core');
const exec = require('@actions/exec');
const fs = require('fs');
const jq = require('node-jq');
const { spawnSync } = require('child_process');

var IS_CARGO_WORKSPACE = false;
var CRATES = [];
var COMPANY_NAME = '';

async function runLicensee(sourcePath) {
  let output = '';
  const options = {};
  options.listeners = {
    stdout: (data) => {
      output += data.toString();
    }
  };
  await exec.exec(
    'docker',
    [
      'run', '--rm', '--volume',
      `${sourcePath}:/usr/src/target`, 'licensee', 'detect',
      '/usr/src/target', '--json'
    ],
    options);
  return output;
}

async function runRipGrep(searchString) {
  // The ripgrep process needs to be run using the underlying Node process libraries,
  // because there are issues when you want to have an argument be enclosed in double quotes,
  // in this case because it is a search string that has spaces in it.
  //
  // The actions/exec package doesn't support configuration of stdio or passing the process
  // through the shell, both of which are necessary for this scenario.
  let output = '';
  const options = {};
  options.shell = true;
  options.stdio = ['ignore', 'pipe', 'inherit'];
  const child = spawnSync(
    'rg',
    [
      '--type', 'rust', '--files-without-match',
      '--fixed-strings', `"${searchString}"`
    ],
    options);
  output = child.stdout.toString().trim();
  // Due to the fact that this process is launched through the shell, it's possible for it to
  // fail if it's not launched in a manner that is compatible with the shell. For example, if
  // searchString contains double quotes, which the shell couldn't parse correctly. In this
  // case, you want the action to fail.
  //
  // However, unfortunately, we can't just check the exit code, because we're asking ripgrep to
  // return files that *do not* contain a certain string. This means that if all the files *do*
  // contain the string we're looking for, ripgrep treats it as an error. In the case where all
  // the files do contain the string, the output will be empty, so we will check that first.
  if (output.length != 0 && child.exitCode != 0) {
    core.setFailed(`Action failed: ${output}`);
  }
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

async function matchLicenseFiles(sourcePath) {
  let licenseeOutput;
  let jqOutput;
  try {
    licenseeOutput = await runLicensee(sourcePath);
    jqOutput = await jq.run(
      '.matched_files[].filename', licenseeOutput, { input: 'string', output: 'json' });
  } catch (err) {
    core.setFailed(`Action failed: ${err}`);
    return;
  }
  // jq includes the " characters around the filenames, which we don't need.
  let matchedFiles = jqOutput.split('\n').map(filename => filename.replace(/\"/g, ''));
  return matchedFiles
}

async function matchLicenseReferences(sourcePath) {
  let licenseeOutput;
  let jqOutput;
  try {
    licenseeOutput = await runLicensee(sourcePath);
    jqOutput = await jq.run(
      '.matched_files[].matched_license', licenseeOutput, { input: 'string', output: 'json' });
  } catch (err) {
    core.setFailed(`Action failed: ${err}`);
    return;
  }
  // jq includes the " characters around the licenses, which we don't need.
  let matchedLicenses = jqOutput.split('\n').map(license => license.replace(/\"/g, ''));
  return matchedLicenses
}

async function matchLicenseReferenceInFile(sourcePath, filename) {
  let licenseeOutput;
  let jqOutput;
  try {
    licenseeOutput = await runLicensee(sourcePath);
    jqOutput = await jq.run(`.matched_files[] | select(.filename=="${filename}")`,
      licenseeOutput, { input: 'string', output: 'string' });
    jqOutput = await jq.run('.matched_license', jqOutput, { input: 'string', output: 'string' });
    return jqOutput;
  } catch (err) {
    core.setFailed(`Action failed: ${err}`);
    return;
  }
}

async function matchLicenseAttribution() {
  let licenseeOutput;
  let jqOutput;
  const cwd = process.cwd();
  try {
    licenseeOutput = await runLicensee(cwd);
    jqOutput = await jq.run(`.matched_files[] | select(.filename=="LICENSE")`,
      licenseeOutput, { input: 'string', output: 'string' });
    jqOutput = await jq.run('.attribution', jqOutput, { input: 'string', output: 'string' });
    // The attribution from Licensee may be encapsulated in double quotes, which we need to remove
    // to pass through the shell when we run ripgrep.
    jqOutput = jqOutput.replace(/\"/g, '');
    return jqOutput;
  } catch (err) {
    core.setFailed(`Action failed: ${err}`);
    return;
  }
}

async function verifyMatchedFiles(matchedFiles, crateName) {
  core.info(`Verifying license files for ${crateName}.`);
  core.info(`Licensee detected ${matchedFiles.length} files with license references:`);
  core.info(matchedFiles)
  if (crateName == 'root') {
    // In this case, we're either examining the root of a workspace repo, or it's a single crate
    // repository. We expect a LICENSE file and a README at the root, but a Cargo.toml may also be
    // matched.
    if (matchedFiles.length < 2) {
      core.info('This repository is either missing a LICENSE file or no license is declared in the README.');
      core.info('Or both.');
      core.info('Please include a LICENSE file and a reference to it in the README.');
      core.setFailed('Verification failed. See above.');
      return;
    } else if (matchedFiles.length > 3) {
      core.info('Licensee detected more than three license references.');
      core.info('To keep things clean, please modify the repository to:');
      core.info('* Use one license in a LICENSE file at the root.');
      core.info('* Make a reference to the license in the README.');
      core.info('* If this is a Cargo repository, add a license to the Cargo manifest.');
      core.setFailed('Verification failed. See above.');
      return;
    }
    if (!matchedFiles.includes('LICENSE')) {
      core.setFailed('Licensee did not detect a valid license in the LICENSE file.');
      return;
    }
  } else {
    // In this case, we're examining a crate within a workspace repo. We would expect at least a
    // README, and a Cargo.toml would also be matched, but not a LICENSE file.
    if (matchedFiles.length < 1) {
      core.info(`${crateName} in the workspace is missing a README file with a license reference.`);
      core.setFailed('Verification failed. See above.');
      return;
    }
    if (matchedFiles.length > 2) {
      core.info(`Licensee detected more than two license references in ${crateName}.`);
      core.info('To keep things clean, please modify the crate to:');
      core.info('* Make a reference to the license in the README.');
      core.info('* If this is a Cargo repository, add a license to the Cargo manifest.');
      core.setFailed('Verification failed. See above.');
      return;
    }
  }
  if (!matchedFiles.includes('README.md')) {
    core.setFailed('Licensee did not detect a valid license in the README file.');
    return;
  }
  core.info('License file verification passed.')
}

async function verifyLicenseFiles() {
  const cwd = process.cwd();
  let matchedFiles = await matchLicenseFiles(cwd);
  await verifyMatchedFiles(matchedFiles, 'root');

  if (IS_CARGO_WORKSPACE) {
    core.info('Examining crates in the workspace:');
    core.info(CRATES)
    for (let i = 0; i < CRATES.length; i++) {
      let crate = CRATES[i];
      core.info(`Processing ${crate}...`);
      let matchedFiles = await matchLicenseFiles(`${cwd}/${crate}`);
      await verifyMatchedFiles(matchedFiles, crate);
    }
  }
}

async function verifyLicenseDetails() {
  const cwd = process.cwd();
  let matchedLicenses = await matchLicenseReferences(cwd);
  core.info('Licensee detected the following license references:');
  core.info(matchedLicenses);

  let cargoLicense;
  let licenseFileLicense = await matchLicenseReferenceInFile(cwd, 'LICENSE');
  let readmeLicense = await matchLicenseReferenceInFile(cwd, 'README.md');
  if (IS_CARGO_WORKSPACE) {
    core.info(`License detected in the root LICENSE file: ${licenseFileLicense}`);
    core.info(`License detected in the root README file: ${readmeLicense}`);
    if (readmeLicense != licenseFileLicense) {
      core.setFailed('The LICENSE and root README must have a matching license.');
      return;
    }

    core.info('Examining crates in the workspace:');
    core.info(CRATES)
    for (let i = 0; i < CRATES.length; i++) {
      let crate = CRATES[i];
      core.info(`Processing ${crate}...`);
      let cargoLicense = await matchLicenseReferenceInFile(`${cwd}/${crate}`, 'Cargo.toml');
      let readmeLicense = await matchLicenseReferenceInFile(`${cwd}/${crate}`, 'README.md');
      core.info(`License detected in the LICENSE file: ${licenseFileLicense}`);
      core.info(`License detected in the README file: ${readmeLicense}`);
      core.info(`License detected in the Cargo.toml file: ${cargoLicense}`);

      if (readmeLicense == licenseFileLicense && cargoLicense == licenseFileLicense) {
        core.info(`Licensing has been applied consistently for ${crate}.`)
      } else {
        core.setFailed(`The ${crate} crate failed validation: each file must have a matching license.`);
        return;
      }
    }
  } else {
    // In the non-workspace repo, all three files are at the root of the repository.
    cargoLicense = await matchLicenseReferenceInFile(`${cwd}`, 'Cargo.toml');
    core.info(`License detected in the LICENSE file: ${licenseFileLicense}`);
    core.info(`License detected in the README file: ${readmeLicense}`);
    core.info(`License detected in the Cargo.toml file: ${cargoLicense}`);
    if (readmeLicense == licenseFileLicense && cargoLicense == licenseFileLicense) {
      core.info('Licensing has been applied consistently.')
      return;
    }
    core.setFailed('The LICENSE, README and Cargo.toml must have a matching license.');
  }
}

async function verifySourceFiles() {
  let attribution = await matchLicenseAttribution();
  if (attribution == 'null' || attribution.trim().length == 0) {
    let year = new Date().getFullYear();
    attribution = `Copyright (C) ${year} ${COMPANY_NAME}.`;
    core.info('No attribution detected in LICENSE.');
    core.info(`We will use ${attribution}`);
  } else {
    const split = attribution.split('\\n');
    if (split.length > 1) {
      // We have multiple attributions, which can occur with a forked
      // repository. We may be obligated to retain the original attribution,
      // e.g., with the MIT license. We'll select the attribution that contains
      // COMPANY_NAME.
      core.info('Multiple attributions have been detected:');
      for (let i in split) {
        let att = split[i];
        core.info(`${att}`);
      }
      attribution = split.find(function(att) {
        return att.includes(COMPANY_NAME);
      });
      if (attribution === undefined) {
        core.setFailed(`None of the attributions contained our company name ${COMPANY_NAME}`);
        return;
      }
      core.info(`We will use ${attribution}`);
    } else {
      core.info(`Detected attribution ${attribution}`);
    }
  }

  core.info(`Searching source files for copyright notice '${attribution}'`);
  let output = await runRipGrep(attribution);
  if (output.length == 0) {
    core.info('All source files contain a copyright notice.');
  } else {
    core.info('The following files were found to be missing a copyright notice:');
    core.info(output);
    core.setFailed('Please add copyright notices to those files.');
  }
}

async function run() {
  await parseInputs();
  await buildLicensee();
  await verifyLicenseFiles();
  await verifyLicenseDetails();
  await verifySourceFiles();
}

run();
