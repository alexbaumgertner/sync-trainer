import type { NextConfig } from "next";
import { withPayload } from "@payloadcms/next/withPayload";

const nextConfig: NextConfig = {
  // Синтез 20 минут аудио идёт десятки секунд; тело ответа большое.
  serverExternalPackages: ["@breezystack/lamejs"],
};

export default withPayload(nextConfig);
