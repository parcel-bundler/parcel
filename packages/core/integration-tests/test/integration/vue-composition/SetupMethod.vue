<template>
  <h2 class='red'>{{ msg }}</h2>
  <Hello />
</template>

<script lang='ts'>
import {ref} from 'vue';
import Hello from './Hello.vue';

export default {
  components: {Hello},
  setup() {
    const msg = ref('Script setup');
    return {msg};
  },
};

</script>

<style>
comp-a h2 {
  color: #f00;
}
</style>
