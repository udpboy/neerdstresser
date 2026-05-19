const { PORT } = require("./src/config");
const app = require("./src/app");
const { ensureUserUniqueCode } = require("./src/db");

(async () => {
  try {
    await ensureUserUniqueCode();
  } catch (err) {
    console.error("Migrations unique_code gagal, lanjutkan tanpa menunggu:", err.message);
  }
  app.listen(PORT, () => {
    console.log(`Auth server running on port ${PORT}`);
  });
})();
