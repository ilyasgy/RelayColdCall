import packageJson from "../package.json" with { type: "json" };

const tag = process.env.RELEASE_TAG || process.argv[2];
const owner = process.env.RELEASE_GITHUB_OWNER || process.env.GITHUB_REPOSITORY_OWNER;
const repo = process.env.RELEASE_GITHUB_REPO || process.env.GITHUB_REPOSITORY?.split("/")[1];
const expectedTag = `v${packageJson.version}`;

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version)) {
  throw new Error(`package.json version must be semantic versioning; received ${packageJson.version}.`);
}

if (tag && tag !== expectedTag) {
  throw new Error(`Release tag ${tag} does not match package.json version ${packageJson.version}. Expected ${expectedTag}.`);
}

if (!owner || !repo) {
  throw new Error("Release repository is missing. Set RELEASE_GITHUB_OWNER and RELEASE_GITHUB_REPO.");
}

console.log(`Release configuration valid: ${owner}/${repo} ${expectedTag}`);
