export default {
  routes: [
    {
      method: 'GET',
      path: '/show-edit/:token',
      handler: 'show-edit.find',
      config: { auth: false },
    },
    {
      method: 'PUT',
      path: '/show-edit/:token',
      handler: 'show-edit.update',
      config: { auth: false },
    },
  ],
};
