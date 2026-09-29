import config from "./src/config/env.js";
import { isEmailEnabled, isEmailConfigured } from "./src/services/email.service.js";
console.log("EMAIL_ENABLED   :", config.EMAIL_ENABLED);
console.log("isEmailConfigured:", isEmailConfigured());
console.log("isEmailEnabled  :", isEmailEnabled());
console.log("SMTP_HOST       :", config.SMTP_HOST);
console.log("SMTP_PORT       :", config.SMTP_PORT);
console.log("process.env.EMAIL_ENABLED:", process.env.EMAIL_ENABLED);
