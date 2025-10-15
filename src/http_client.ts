import axios from "axios";
import * as jwt from "jsonwebtoken";

const INTERNAL_API_SECRET = "MisomeInternal_123Trqtwref&2536";
const INTERNAL_API_AUD = "express-service";
const INTERNAL_API_ISS = "nest-service";

const http = axios.create();

http.interceptors.request.use((config) => {
  const token = jwt.sign({ iss: INTERNAL_API_ISS }, INTERNAL_API_SECRET, {
    audience: INTERNAL_API_AUD,
    expiresIn: "10m",
  });
  config.headers = {
    ...(config.headers || {}),
    "x-internal-auth": `Bearer ${token}`,
  };
  return config;
});

export default http;
