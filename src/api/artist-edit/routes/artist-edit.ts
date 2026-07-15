export default {
  routes: [
    {
      method: 'GET',
      path: '/artist-edit/:token',
      handler: 'artist-edit.find',
      config: { auth: false },
    },
    {
      method: 'PUT',
      path: '/artist-edit/:token',
      handler: 'artist-edit.update',
      config: { auth: false },
    },
  ],
};
