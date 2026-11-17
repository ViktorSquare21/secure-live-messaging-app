const serverPort = process.env.PORT || '3000';

export default {
  '/socket.io': {
    target: `http://127.0.0.1:${serverPort}`,
    ws: true,
    secure: false,
  },
};
