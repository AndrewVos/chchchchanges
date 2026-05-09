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

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates false

  app "Chchchchanges.app"

  uninstall quit: "lol.vos.chchchchanges"

  zap trash: [
    "~/Library/Application Support/Chchchchanges",
    "~/Library/Application Support/chchchchanges",
    "~/Library/Caches/lol.vos.chchchchanges",
    "~/Library/Logs/Chchchchanges",
    "~/Library/Preferences/lol.vos.chchchchanges.plist",
    "~/Library/Saved Application State/lol.vos.chchchchanges.savedState",
  ]

  caveats <<~EOS
    This build is not notarized yet. If macOS blocks launch, run:

      xattr -dr com.apple.quarantine /Applications/Chchchchanges.app
  EOS
end
`;

await mkdir("Casks", { recursive: true });
await writeFile("Casks/chchchchanges.rb", cask);
