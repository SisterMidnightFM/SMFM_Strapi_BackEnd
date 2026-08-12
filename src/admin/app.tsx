import type { StrapiApp } from '@strapi/strapi/admin';
import { RadioCultPanel } from './radiocult/Panel';

const EPISODE_MODEL = 'api::episode.episode';

export default {
  config: {
    locales: [],
    // Edit-view field labels. content-manager renders each field's label
    // through formatMessage with the id below, falling back to the raw
    // attribute name — so this is how you get a readable label from code
    // rather than from "Configure the view".
    translations: {
      en: {
        [`content-manager.content-types.${EPISODE_MODEL}.UploadManually`]: 'Upload manually',
        [`content-manager.content-types.${EPISODE_MODEL}.SoundcloudLink`]: 'SoundCloud link',
        [`content-manager.content-types.${EPISODE_MODEL}.MixCloudLink`]: 'Mixcloud link',
      },
    },
  },
  bootstrap(app: StrapiApp) {
    // apis is typed Record<string, unknown>; addEditViewSidePanel exists at runtime.
    const contentManager = app.getPlugin('content-manager') as any;
    contentManager.apis.addEditViewSidePanel([RadioCultPanel]);
  },
};
