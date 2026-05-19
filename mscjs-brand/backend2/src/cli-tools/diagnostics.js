const os = require("os");

module.exports = {
  id: "diagnostics",
  name: "Diagnostics",
  description: "Server diagnostics (safe info only).",
  inputs: [
    { key: "echo", label: "Echo", type: "string", required: false, placeholder: "hello" },
    { key: "verbose", label: "Verbose", type: "checkbox", required: false, default: false },
  ],
  async run(ctx, input) {
    const echo = typeof input?.echo === "string" ? input.echo.slice(0, 200) : null;
    const verbose = !!input?.verbose;
    const uptimeSec = Math.floor(process.uptime());
    const out = [
      `server_time: ${new Date().toISOString()}`,
      `uptime: ${uptimeSec}s`,
      `node: ${process.version}`,
      `platform: ${process.platform} ${process.arch}`,
      `cpus: ${os.cpus()?.length || 0}`,
      `user: ${ctx?.user?.username || "-"}`,
      `ip: ${ctx?.ip || "-"}`,
      echo ? `echo: ${echo}` : null,
      verbose ? `hostname: ${os.hostname()}` : null,
    ].filter(Boolean);

    return { output: out.join("\n") };
  },
};
