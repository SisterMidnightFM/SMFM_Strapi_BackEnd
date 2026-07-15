export default {
  routes: [
    {
      method: 'GET',
      path: '/episode-edit/:token',
      handler: 'episode-edit.find',
      config: { auth: false },
    },
    {
      method: 'PUT',
      path: '/episode-edit/:token',
      handler: 'episode-edit.update',
      config: { auth: false },
    },
  ],
};
