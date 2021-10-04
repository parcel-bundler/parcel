<script setup lang='ts'>
import {ref} from 'vue';
import HelloWorld from './HelloWorld.vue';

const count = ref(0);
</script>

<template>
  <div>
    <button @click='count++'>{{ count }}</button>
    <HelloWorld />
  </div>
</template>
