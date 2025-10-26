import type { Schema, Struct } from '@strapi/strapi';

export interface ShowSlotsShows extends Struct.ComponentSchema {
  collectionName: 'components_show_slots_shows';
  info: {
    displayName: 'Shows';
    icon: 'music';
  };
  attributes: {
    End_Time: Schema.Attribute.Time;
    Show_Name: Schema.Attribute.Relation<'oneToOne', 'api::show.show'>;
    Start_Time: Schema.Attribute.Time;
  };
}

export interface TracksTrackList extends Struct.ComponentSchema {
  collectionName: 'components_tracks_track_lists';
  info: {
    displayName: 'TrackList';
    icon: 'music';
  };
  attributes: {
    Artist: Schema.Attribute.String;
    Track_Title: Schema.Attribute.String;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'show-slots.shows': ShowSlotsShows;
      'tracks.track-list': TracksTrackList;
    }
  }
}
