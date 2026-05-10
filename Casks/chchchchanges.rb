cask "chchchchanges" do
  version "1.0.3"
  sha256 "730162c21e330153a8d17cc85414a554a374605853956f7fe1e8a3fcf1965ad7"

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
