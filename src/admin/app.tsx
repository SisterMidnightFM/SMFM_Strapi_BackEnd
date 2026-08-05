import type { StrapiApp } from '@strapi/strapi/admin';
import { RadioCultPanel } from './radiocult/Panel';

export default {
  config: {
    locales: [],
  },
  bootstrap(app: StrapiApp) {
    // apis is typed Record<string, unknown>; addEditViewSidePanel exists at runtime.
    const contentManager = app.getPlugin('content-manager') as any;
    contentManager.apis.addEditViewSidePanel([RadioCultPanel]);
  },
};
