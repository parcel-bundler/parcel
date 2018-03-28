<style scoped>
.test {
  color: yellow;
}
.test:after {
  content: 'bye!';
}
h1 {
  color: green;
}
</style>

<template>
<div>
  <div><h1>hi</h1></div>
  <p class="abc def">hi</p>
  <template v-if="ok"><p class="test">yo</p></template>
  <svg><template><p></p></template></svg>
</div>
</template>

<script>
export default {
  data () {
    return { ok: true }
  }
}
</script>
