<template>
  <h2 class='red'>{{ msg }}</h2>
  <Hello msg="Hello world!"></Hello>
</template>

<script setup lang='ts'>
import Hello from './Hello.vue';
import {ref} from 'vue';

const msg = ref('Script setup');
</script>

<style>
comp-a h2 {
  color: #f00;
}
</style>
