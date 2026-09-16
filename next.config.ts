import type { NextConfig } from "next";
import { withPayload } from "@payloadcms/next/withPayload";

const nextConfig: NextConfig = {
  // Синтез 20 минут аудио идёт десятки секунд; тело ответа большое.
  // Обе библиотеки — wasm/нативные обёртки, бандлить их нельзя:
  // lamejs кодирует MP3, mpg123-decoder расшифровывает его ради формы волны.
  serverExternalPackages: ["@breezystack/lamejs", "mpg123-decoder"],
};

export default withPayload(nextConfig);
