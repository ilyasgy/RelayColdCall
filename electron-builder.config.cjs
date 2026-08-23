const releaseOwner = process.env.RELEASE_GITHUB_OWNER || process.env.GITHUB_REPOSITORY_OWNER;
const releaseRepo = process.env.RELEASE_GITHUB_REPO || process.env.GITHUB_REPOSITORY?.split("/")[1];

const publish = releaseOwner && releaseRepo
  ? [{
      provider: "github",
      owner: releaseOwner,
      repo: releaseRepo,
      releaseType: "release",
      channel: "latest",
    }]
  : undefined;

module.exports = {
  appId: "com.relay.leadoperations",
  productName: "Relay Lead Operations",
  electronDist: "node_modules/electron/dist",
  asar: true,
  compression: "maximum",
  directories: {
    output: "release",
  },
  files: [
    "dist/**/*",
    "electron/**/*",
    "package.json",
  ],
  win: {
    executableName: "Relay Lead Operations",
    target: [{ target: "nsis", arch: ["x64"] }],
    artifactName: "Relay-Setup-${version}-${arch}.${ext}",
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: true,
    allowToChangeInstallationDirectory: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "Relay Lead Operations",
    deleteAppDataOnUninstall: false,
  },
  publish,
};
