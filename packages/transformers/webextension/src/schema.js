// @flow strict-local
import type {SchemaEntity} from '@parcel/utils';

const validateVersion = (ver: string): ?string => {
  const parts = ver.split('.', 5);
  if (parts.length == 5) return 'Extension versions to have at most three dots';
  if (
    parts.every(
      part => part.length != 0 && Number(part[0]) >= 0 && Number(part) < 65536,
    )
  )
    return;
  return 'Extension versions must be dot-separated integers between 0 and 65535';
};
const icons: SchemaEntity = {
  type: 'object',
  properties: {},
  additionalProperties: {type: 'string'},
};

const actionProps = {
  // FF only
  browser_style: {type: 'boolean'},
  // You can also have a raw string, but not in Edge, apparently...
  default_icon: {
    oneOf: [icons, {type: 'string'}],
  },
  default_popup: {type: 'string'},
  default_title: {type: 'string'},
};

const arrStr = {
  type: 'array',
  items: {
    type: 'string',
  },
};

// This has *some* Chrome bias, but let's be real here...
// It's mainly intended to be highly cross-browser compatible
export default ({
  type: 'object',
  properties: {
    manifest_version: {
      type: 'number',
      enum: [2],
    },
    name: {type: 'string'},
    version: {
      type: 'string',
      __validate: validateVersion,
    },
    default_locale: {type: 'string'},
    description: {type: 'string'},
    icons,
    browser_action: {
      type: 'object',
      properties: {
        ...actionProps,
        // rest are FF only
        default_area: {
          type: 'string',
          enum: ['navbar', 'menupanel', 'tabstrip', 'personaltoolbar'],
        },
        theme_icons: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              light: {type: 'string'},
              dark: {type: 'string'},
              size: {type: 'number'},
            },
            required: ['light', 'dark', 'size'],
          },
        },
      },
    },
    page_action: {
      type: 'object',
      properties: {
        ...actionProps,
        // rest are FF only
        hide_matches: arrStr,
        show_matches: arrStr,
        pinned: {type: 'boolean'},
      },
    },
    author: {type: 'string'},
    background: {
      type: 'object',
      properties: {
        scripts: arrStr,
        page: {type: 'string'},
        persistent: {type: 'boolean'},
      },
    },
    chrome_settings_overrides: {
      type: 'object',
      properties: {
        homepage: {type: 'string'},
        search_provider: {
          type: 'object',
          properties: {
            name: {type: 'string'},
            keyword: {type: 'string'},
            favicon_url: {type: 'string'},
            search_url: {type: 'string'},
            encoding: {type: 'string'},
            suggest_url: {type: 'string'},
            image_url: {type: 'string'},
            instant_url: {type: 'string'},
            search_url_post_params: {type: 'string'},
            suggest_url_post_params: {type: 'string'},
            image_url_post_params: {type: 'string'},
            instant_url_post_params: {type: 'string'},
            alternate_urls: arrStr,
            prepopulated_id: {type: 'number'},
            is_default: {type: 'boolean'},
          },
          required: ['name', 'search_url'],
        },
        startup_pages: arrStr,
      },
    },
    chrome_url_overrides: {
      type: 'object',
      properties: {
        bookmarks: {type: 'string'},
        history: {type: 'string'},
        newtab: {type: 'string'},
      },
    },
    commands: ({
      type: 'object',
      properties: {},
      additionalProperties: {
        type: 'object',
        properties: {
          suggested_key: {
            type: 'object',
            properties: {
              default: {type: 'string'},
              mac: {type: 'string'},
              linux: {type: 'string'},
              windows: {type: 'string'},
              chromeos: {type: 'string'},
              android: {type: 'string'},
              ios: {type: 'string'},
            },
          },
          description: {type: 'string'},
        },
      },
    }: SchemaEntity),
    content_scripts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          matches: arrStr,
          css: arrStr,
          js: arrStr,
          match_about_blank: {type: 'boolean'},
          exclude_matches: arrStr,
          include_globs: arrStr,
          exclude_globs: arrStr,
          run_at: {
            type: 'string',
            enum: ['document_idle', 'document_start', 'document_end'],
          },
          all_frames: {type: 'boolean'},
        },
        required: ['matches'],
      },
    },
    content_security_policy: {type: 'string'},
    devtools_page: {type: 'string'},
    // looks to be FF only
    dictionaries: ({
      type: 'object',
      properties: {},
      additionalProperties: {type: 'string'},
    }: SchemaEntity),
    externally_connectable: {
      type: 'object',
      properties: {
        ids: arrStr,
        matches: arrStr,
        accept_tls_channel_id: {type: 'boolean'},
      },
    },
    // These next two are where it gets a bit Chrome-y
    // (we don't include all because some have next to no actual use)
    file_browser_handlers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: {type: 'string'},
          default_title: {type: 'string'},
          file_filters: arrStr,
        },
        required: ['id', 'default_title', 'file_filters'],
      },
    },
    file_system_provider_capabilities: {
      type: 'object',
      properties: {
        configurable: {type: 'boolean'},
        multiple_mounts: {type: 'boolean'},
        watchable: {type: 'boolean'},
        source: {
          type: 'string',
          enum: ['file', 'device', 'network'],
        },
      },
      required: ['source'],
    },
    homepage_url: {type: 'string'},
    incognito: {
      type: 'string',
      enum: ['spanning', 'split', 'not_allowed'],
    },
    minimum_chrome_version: {
      type: 'string',
      __validate: validateVersion,
    },
    // No NaCl modules because deprecated
    offline_enabled: {type: 'boolean'},
    omnibox: ({
      type: 'object',
      properties: {},
      additionalProperties: {type: 'string'},
    }: SchemaEntity),
    optional_permissions: arrStr,
    // options_page is deprecated
    options_ui: {
      type: 'object',
      properties: {
        browser_style: {type: 'boolean'},
        open_in_tab: {type: 'boolean'},
        page: {type: 'string'},
      },
      required: ['page'],
    },
    permissions: arrStr,
    // FF only, but has some use
    protocol_handlers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          protocol: {type: 'string'},
          name: {type: 'string'},
          uriTemplate: {type: 'string'},
        },
        required: ['protocol', 'name', 'uriTemplate'],
      },
    },
    // Chrome only
    requirements: {
      type: 'object',
      properties: {
        '3D': {
          type: 'object',
          properties: {
            features: arrStr,
          },
        },
      },
    },
    // sandbox is deprecated
    short_name: {type: 'string'},
    // FF only, but has some use
    sidebar_action: {
      type: 'object',
      properties: {
        browser_style: actionProps.browser_style,
        default_icon: actionProps.default_icon,
        default_panel: {type: 'string'},
        default_title: {type: 'string'},
        open_at_install: {type: 'boolean'},
      },
      required: ['default_panel'],
    },
    storage: {
      type: 'object',
      properties: {
        managed_schema: {type: 'string'},
      },
    },
    theme: {
      type: 'object',
      properties: {
        images: {
          type: 'object',
          properties: {
            theme_frame: {type: 'string'},
            additional_backgrounds: arrStr,
          },
        },
        colors: {
          type: 'object',
          properties: {
            bookmark_text: {type: 'string'},
            button_background_active: {type: 'string'},
            button_background_hover: {type: 'string'},
            icons: {type: 'string'},
            icons_attention: {type: 'string'},
            frame: {type: 'string'},
            frame_inactive: {type: 'string'},
            ntp_background: {type: 'string'},
            ntp_text: {type: 'string'},
            popup: {type: 'string'},
            popup_border: {type: 'string'},
            popup_highlight: {type: 'string'},
            popup_highlight_text: {type: 'string'},
            popup_text: {type: 'string'},
            sidebar: {type: 'string'},
            sidebar_border: {type: 'string'},
            sidebar_highlight: {type: 'string'},
            sidebar_highlight_text: {type: 'string'},
            sidebar_text: {type: 'string'},
            tab_background_separator: {type: 'string'},
            tab_background_text: {type: 'string'},
            tab_line: {type: 'string'},
            tab_loading: {type: 'string'},
            tab_selected: {type: 'string'},
            tab_text: {type: 'string'},
            toolbar: {type: 'string'},
            toolbar_bottom_separator: {type: 'string'},
            toolbar_field: {type: 'string'},
            toolbar_field_border: {type: 'string'},
            toolbar_field_border_focus: {type: 'string'},
            toolbar_field_focus: {type: 'string'},
            toolbar_field_highlight: {type: 'string'},
            toolbar_field_highlight_text: {type: 'string'},
            toolbar_field_separator: {type: 'string'},
            toolbar_field_text: {type: 'string'},
            toolbar_field_text_focus: {type: 'string'},
            toolbar_text: {type: 'string'},
            toolbar_top_separator: {type: 'string'},
            toolbar_vertical_separator: {type: 'string'},
          },
        },
        properties: {
          type: 'object',
          properties: {
            additional_backgrounds_alignment: arrStr,
            additional_backgrounds_tiling: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['no-repeat', 'repeat', 'repeat-x', 'repeat-y'],
              },
            },
          },
        },
      },
      required: ['colors'],
    },
    tts_engine: {
      type: 'object',
      properties: {
        voices: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              voice_name: {type: 'string'},
              lang: {type: 'string'},
              event_type: {
                type: 'string',
                enum: ['start', 'word', 'sentence', 'marker', 'end', 'error'],
              },
            },
            required: ['voice_name', 'event_type'],
          },
        },
      },
    },
    user_scripts: {
      type: 'object',
      properties: {
        api_script: {type: 'string'},
      },
    },
    version_name: {type: 'string'},
    web_accessible_resources: arrStr,
  },
}: SchemaEntity);
