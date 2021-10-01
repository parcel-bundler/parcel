<template>
  <h2 class='red'>{{ msg }}</h2>
</template>

<script lang='ts'>
export default {
  methods: {
    demo(){}
  }
};
</script>
<script setup lang='ts'>
import {ref} from 'vue';

const msg = ref('Script setup');
</script>

<style>
comp-a h2 {
  color: #f00;
}
</style>
