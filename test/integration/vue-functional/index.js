import Vue from 'vue/dist/vue.esm.js';
import App from './App.vue';

window.myVue = new Vue({
  el: '#app',
  render: h => h(App)
});