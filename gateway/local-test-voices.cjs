'use strict';
const localTestVoices = Object.freeze([
  Object.freeze({ id: 'lissa', name: 'Lissa' }),
  Object.freeze({ id: 'emma', name: 'Emma' }),
  Object.freeze({ id: 'olivia', name: 'Olivia' }),
  Object.freeze({ id: 'lauren', name: 'Lauren' }),
]);
/** @param {unknown} voice */
const isLocalTestVoice = voice => localTestVoices.some(item => item.id === voice);
module.exports = { localTestVoices, isLocalTestVoice };
