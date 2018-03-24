import Vue from 'vue/dist/vue.esm.js';
import PreProcessors from './pre-processors.vue';

window.myVue = new Vue({
  el: '#app',
  render: h => h(PreProcessors)
});