'use strict';

const fs = require('fs');
const exec = require('child_process').exec;

module.exports = {
  versions(raw) {
    return typeof raw === 'string'
      ? raw.split('.') : [];
  },

  version(raw, flag, reset = false) {
    if (reset) {
      return 0;
    }

    const parsed = parseInt(raw);
    const value = parsed >= 0 ? parsed : 0;
    return flag ? value + 1 : value;
  },

  replacePlaceholdersFromPbxproj(string, pathToPbxproj) {
    const pbxProjContent = fs.readFileSync(pathToPbxproj, 'utf8');

    // Convert to set and back to remove duplicates, since replaceAll will replace all instances of a placeholder
    const placeholders = [...new Set(string.match(/\$\([^)]*\)/))];
    for (let placeholder of placeholders) {
      // Slice to remove $( and )
      const regex = new RegExp(`${placeholder.slice(2,-1)}\\s*=\\s*([^;]+);`);
      const match = pbxProjContent.match(regex);
      if (match) string = string.replaceAll(placeholder, match[1]);
    }

    return string;
  },

  getPackageInfo(pathToFile) {
    return JSON.parse(fs.readFileSync(pathToFile, 'utf8'));
  },

  getMaximumBuildNumber(pathToPlist, pathToPbxproj = null) {
    const buildNumbers = [];
    buildNumbers.push(this.getBuildNumberFromPlist(pathToPlist, pathToPbxproj));

    return Math.max(...buildNumbers);
  },

  matchPlistBuildNumber(content) {
    return content.match(/(<key>CFBundleVersion<\/key>\s+<string>)(.*)(<\/string>)/)[2];
  },

  matchPlistVersionNumber(content) {
    return content.match(/(<key>CFBundleShortVersionString<\/key>\s+<string>)(.*)(<\/string>)/)[2];
  },

  getBuildNumberFromPlist(pathToPlist, pathToPbxproj = null) {
    const content = fs.readFileSync(pathToPlist, 'utf8');
    const match = this.matchPlistBuildNumber(content);
    if (match) {
      let result = match;
      if (pathToPbxproj) result = this.replacePlaceholdersFromPbxproj(match, pathToPbxproj);
      return parseInt(result);
    }

    return 1;
  },

  setBuildSetting(content, key, newValue) {
    // Escape key in case it ever contains regex characters
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const regex = new RegExp(`(${escapedKey}\\s*=\\s*)([^;]*)(;)`, 'g');

    return content.replaceAll(regex, (_, prefix, _oldValue, suffix) => {
      return `${prefix}${newValue}${suffix}`;
    });
  },

  changeVersionInPackage(pathToFile, version) {
    let packageContent = fs.readFileSync(pathToFile, 'utf8');
    packageContent = packageContent.replace(/("version":\s*")([\d\.]+)(")/g, `$1${version}$3`);
    fs.writeFileSync(pathToFile, packageContent, 'utf8');
  },

  isSingleVariableRef(str) {
    return /^\$\([^)]+\)$/.test(str);
  },

  changeVersionAndBuildInPlist(pathToPlist, version, build, pathToPbxproj = null) {
    let plistContent = fs.readFileSync(pathToPlist, 'utf8');
    let pbxProjContent = null;
    const rawBuildNumber = this.matchPlistBuildNumber(plistContent);
    const rawVersion = this.matchPlistVersionNumber(plistContent);

    if (pathToPbxproj) {
      pbxProjContent = fs.readFileSync(pathToPbxproj, 'utf8');
    }

    if (!isNaN(parseInt(rawBuildNumber))) {
        plistContent = plistContent.replace(/(<key>CFBundleVersion<\/key>\s+<string>)([\d\.]+)(<\/string>)/g, `$1${build}$3`);
    }
    else if (this.isSingleVariableRef(rawBuildNumber) && pathToPbxproj) {
      pbxProjContent = this.setBuildSetting(pbxProjContent, rawBuildNumber.slice(2, -1), build);
    } else {
      throw new Error('Build number in plist is not a single variable nor a number. Unsure how to proceed, bailing out');
    }

    if (!rawVersion.split('.').some(part => !isNaN(parseInt(part))) && rawVersion.split('.').length === 3) {
      plistContent = plistContent.replace(/(<key>CFBundleShortVersionString<\/key>\s*<string>)([\d\.]+)(<\/string>)/g, `$1${version}$3`);
    } else if (this.isSingleVariableRef(rawVersion) && pathToPbxproj) {
      pbxProjContent = this.setBuildSetting(pbxProjContent, rawVersion.slice(2, -1), version);
    } else {
      throw new Error('Version number in plist is not a single variable nor a number. Unsure how to proceed, bailing out');
    }

    fs.writeFileSync(pathToPlist, plistContent, 'utf8');
    if (pathToPbxproj) fs.writeFileSync(pathToPbxproj, pbxProjContent, 'utf8');
  },

  changeVersionAndBuildInGradle(pathToFile, version, build) {
    let content = fs.readFileSync(pathToFile, 'utf8');
    content = content.replace(/(\s*versionName\s+["']?)([\d\.]+)(["']?\s*)/g, `$1${version}$3`);
    content = content.replace(/(\s*versionCode\s+["']?)(\d+)(["']?\s*)/g, `$1${build}$3`);
    fs.writeFileSync(pathToFile, content, 'utf8');
  },

  commitVersionIncrease(version, message, pathsToAdd = []) {
    return new Promise((resolve, reject) => {
      exec(`git add ${pathsToAdd.join(' ')} && git commit -m '${message}' && git tag -a v${version} -m '${message}'`, error => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
};
