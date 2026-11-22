// stdout carries only protocol messages (one JSON object per line).
export const send = (msg: object) => process.stdout.write(JSON.stringify(msg) + "\n");

/** Live status for a running job, shown in the app. */
export const progress = (serial: string, message: string) => send({ event: "progress", serial, message });
