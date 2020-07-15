<template>
  <div class="small">
    Hello {{hello}}!
    <other-component />
  </div>
</template>

<script>
import OtherComponent from './Other.vue'
export default {
  components: {
    'other-component': OtherComponent
  },
  data() {
    return {
      hello: 'world'
    }
  }
}
</script>

<style scoped>
.small {
  color: red;
}
</style>