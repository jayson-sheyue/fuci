'use strict';

let implementation = (url, options) => globalThis.fetch(url, options);

function setFetchImplementation(fn) {
  implementation = fn;
}

function httpFetch(url, options) {
  return implementation(url, options);
}

module.exports = {
  setFetchImplementation,
  httpFetch,
};
