cask "chchchchanges" do
  version "1.0.1"
  sha256 "d8310e3a9eea09c38e17012d8b3a9e0ef215936ab63efeb76a084d8ad2631e6e"

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
