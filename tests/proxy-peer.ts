import { createConnection } from 'node:net';
const socket = createConnection(process.argv[2]);
process.stdin.pipe(socket); socket.pipe(process.stdout);
socket.on('error', () => process.exit(1));
socket.on('end', () => process.exit(0));
