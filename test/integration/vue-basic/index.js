import Vue from 'vue/dist/vue.esm.js';
import Basic from './Basic.vue';

window.myVue = new Vue({
  el: '#app',
  render: h => h(App)
});