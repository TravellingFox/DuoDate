const { expo } = require('./app.json');

module.exports = {
  ...expo,

  android: {
    ...(expo.android ?? {}),
    package: 'com.duodate.app',
  },

  plugins: [
    ...(expo.plugins ?? []),
    'expo-notifications',
    [
      'expo-image-picker',
      {
        photosPermission: 'DuoDate uses your photo library only when you choose a memory to save.',
        cameraPermission: 'DuoDate uses the camera only when you choose to capture a memory.',
        microphonePermission: 'DuoDate uses the microphone only when you choose to record a voice note or video.',
      },
    ],
    [
      'expo-audio',
      {
        microphonePermission: 'DuoDate uses the microphone only when you choose to record a voice note or video.',
      },
    ],
  ],
};