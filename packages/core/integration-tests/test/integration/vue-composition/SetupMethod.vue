<template>
  <h2 class='red'>{{ msg }}</h2>
</template>

<script lang='ts'>
import {ref} from 'vue';

export default {
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
