module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['./'],
          alias: {
            '@': './src',
            '@app': './app',
            '@assets': './assets',
          },
        },
      ],
      // react-native-worklets/plugin (formerly react-native-reanimated/plugin) MUST be last
      'react-native-worklets/plugin',
    ],
  };
};
