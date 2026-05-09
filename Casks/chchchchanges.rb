cask "chchchchanges" do
  version "1.0.0"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"

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
