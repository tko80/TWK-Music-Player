// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "TWKCapacitorMusicPlayer",
    platforms: [.iOS(.v14)],
    products: [
        .library(name: "TWKCapacitorMusicPlayer", targets: ["Plugin"])
    ],
    dependencies: [
        .package(name: "Capacitor", path: "../../../node_modules/@capacitor/ios")
    ],
    targets: [
        .target(
            name: "Plugin",
            dependencies: [.product(name: "Capacitor", package: "Capacitor")],
            path: "Sources/Plugin"
        )
    ]
)
