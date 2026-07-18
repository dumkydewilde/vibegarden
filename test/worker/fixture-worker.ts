export default {
  fetch() {
    return Response.json({ ok: true });
  },
} satisfies ExportedHandler<Env>;
