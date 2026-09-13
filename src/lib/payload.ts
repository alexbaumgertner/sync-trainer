import "server-only";
import { getPayload, type Payload } from "payload";
import config from "@payload-config";

let instance: Promise<Payload> | null = null;

/** Один экземпляр на процесс: инициализация Payload дорогая. */
export const payloadClient = (): Promise<Payload> => (instance ??= getPayload({ config }));
