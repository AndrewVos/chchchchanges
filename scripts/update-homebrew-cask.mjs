import { mkdir, writeFile } from "node:fs/promises";

const [version, sha256] = process.argv.slice(2);

if (!version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error("Usage: bun scripts/update-homebrew-cask.mjs <semver-version> <sha256>");
}

if (!sha256 || !/^[a-f0-9]{64}$/i.test(sha256)) {
  throw new Error("Expected a 64-character SHA-256 checksum.");
}

const cask = `cask "chchchchanges" do
  version "${version}"
  sha256 "${sha256.toLowerCase()}"

  url "https://github.com/AndrewVos/chchchchanges/releases/download/v#{version}/Chchchchanges-#{version}-mac-universal.dmg",
      verified: "github.com/AndrewVos/chchchchanges/"
  name "Chchchchanges"
  desc "Desktop pull request review app for GitHub and Bitbucket"
  homepage "https://github.com/AndrewVos/chchchchanges"

  app "Chchchchanges.app"

  zap trash: [
    "~/Library/Application Support/chchchchanges",
    "~/Library/Preferences/lol.vos.chchchchanges.plist",
    "~/Library/Saved Application State/lol.vos.chchchchanges.savedState",
  ]
end
`;

await mkdir("Casks", { recursive: true });
await writeFile("Casks/chchchchanges.rb", cask);
