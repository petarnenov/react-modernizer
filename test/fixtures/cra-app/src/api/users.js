const http = require('./http');

export const getUser = (id) => http.get(`/users/${id}`);
