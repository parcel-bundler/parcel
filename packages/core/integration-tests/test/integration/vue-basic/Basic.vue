<template>
  <h2 class="red">{{msg}}</h2>
</template>

<script>
  export default {
    data () {
      return {
        msg: 'Hello from Component A!'
      }
    }
  }
</script>

<style>
  comp-a h2 {
    color: #f00;
  }
</style>
