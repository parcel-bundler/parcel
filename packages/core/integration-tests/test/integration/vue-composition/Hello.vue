<script setup lang='ts'>
import {ref, defineProps} from 'vue';

const {msg} = defineProps<{
  msg: string
}>();

const count = ref(0);
</script>

<template>
  <h1>{{ msg }}</h1>
  <button type='button' @click='count++'>count is: {{ count }}</button>
</template>

<style scoped>
a {
  color: #42b983;
}
</style>
