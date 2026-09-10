const { app } = require("electron");
app.whenReady().then(() => { console.log("documents =", app.getPath("documents")); console.log("userData =", app.getPath("userData")); app.quit(); });
